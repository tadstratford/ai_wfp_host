import type { WFP_API } from "@backend/core/wfp";
import { getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import { userManager } from "@backend/core/admin/userManager";
import { capabilitySecretKey } from "../auth";

const QBO_OAUTH_BASE = "https://oauth.platform.intuit.com/oauth2/v1";
const QBO_AP_BASE_PROD = "https://quickbooks.api.intuit.com";
const QBO_AP_BASE_SANDBOX = "https://sandbox-quickbooks.api.intuit.com";

// QBO connection tokens are keyed by the workspace (client) scope, not the
// user's permanent databaseId. Each client keeps its own connection, so
// switching workspaces can never surface another client's QBO instance.
// The Map is a hot in-memory cache; the source of truth is the per-workspace
// secret persisted in the host's encrypted secrets vault (AES-256-GCM).
const tokensByScope = new Map<string, QBOAuthTokens>();

/** Legacy secret name (pre-capability) — read on miss for backward compatibility. */
const LEGACY_QBO_SECRET = "qbo_tokens";

/** Workspace-scoped secret name under which a workspace's QBO tokens live. */
function qboSecretKey(scope: string): string {
  return capabilitySecretKey("qbo", scope);
}

export interface QBOAuthTokens {
  access_token: string;
  refresh_token: string;
  realm_id: string;
  expires_at: number;
  company_name?: string;
}

/** Resolve the QBO connection scope for a databaseId: the active workspace's
 *  id when one is open, otherwise the databaseId itself (blank/disk-local). */
export function resolveQboScope(databaseId: string): string {
  const session = getSessionByDatabaseId(databaseId);
  return session?.workspaceId ?? databaseId;
}

function persistQboTokens(scope: string, tokens: QBOAuthTokens): void {
  void userManager
    .saveSecretByWorkspaceId(scope, qboSecretKey(scope), JSON.stringify(tokens))
    .catch((err: any) => console.error("[qbo] persist failed:", err?.message ?? err));
}

function deletePersistedQboTokens(scope: string): void {
  void userManager
    .deleteSecretByWorkspaceId(scope, qboSecretKey(scope))
    .catch((err: any) => console.error("[qbo] delete persisted failed:", err?.message ?? err));
  // Clean up the legacy (pre-capability) key for tokens stored before the
  // workspace-scoped naming was introduced.
  void userManager
    .deleteSecretByWorkspaceId(scope, LEGACY_QBO_SECRET)
    .catch((err: any) => console.error("[qbo] delete legacy persisted failed:", err?.message ?? err));
}

export function setQboTokens(scope: string, tokens: QBOAuthTokens): void {
  tokensByScope.set(scope, tokens);
  persistQboTokens(scope, tokens);
}

export function getQboTokens(scope: string): QBOAuthTokens | null {
  return tokensByScope.get(scope) ?? null;
}

/** Clear a workspace's QBO connection (in-memory cache and persisted secret). */
export function clearQboTokens(scope: string): void {
  tokensByScope.delete(scope);
  deletePersistedQboTokens(scope);
}

/** Clear only the in-memory cache for a scope, keeping the persisted secret
 *  (used on logout so the connection survives to the next login). */
export function clearQboTokensFromMemory(scope: string): void {
  tokensByScope.delete(scope);
}

export function clearAllQboTokens(): void {
  tokensByScope.clear();
}

interface QBOQueryOpts {
  select?: string;
  where?: string;
  orderBy?: string;
  maxResults?: number;
}

function clientId(): string {
  const id = process.env.QBO_CLIENT_ID;
  if (!id) throw new Error("QBO_CLIENT_ID env not set");
  return id;
}

function clientSecret(): string {
  const sec = process.env.QBO_CLIENT_SECRET;
  if (!sec) throw new Error("QBO_CLIENT_SECRET env not set");
  return sec;
}

export function qboOAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "com.intuit.quickbooks.accounting",
    state,
  });
  return `https://appcenter.intuit.com/connect/oauth2?${params}`;
}

export async function qboExchangeCode(
  code: string,
  redirectUri: string,
  realmId: string,
  scope: string,
): Promise<void> {
  const resp = await fetch(`${QBO_OAUTH_BASE}/tokens/bearer`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId()}:${clientSecret()}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`QBO token exchange failed: ${resp.status} ${text}`);
  }

  const data = await resp.json();
  const tokens: QBOAuthTokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    realm_id: realmId,
    expires_at: Date.now() + (data.expires_in - 120) * 1000,
  };

  setQboTokens(scope, tokens);

  // Best-effort: resolve the company name now so the UI can show it without
  // an extra lookup on every render. A failure here must not fail the OAuth.
  try {
    const client = new QBOClient(scope);
    await client.connect();
    const info = await client.companyInfo();
    if (info?.CompanyName) {
      setQboTokens(scope, { ...tokens, company_name: info.CompanyName });
    }
  } catch {
    // company name is optional
  }
}


async function loadTokens(scope: string): Promise<QBOAuthTokens> {
  const cached = tokensByScope.get(scope);
  if (cached) return cached;

  // Cache miss (fresh process / re-hydration) — pull from the encrypted vault.
  // Try the workspace-scoped capability key first, then the legacy key.
  const persisted =
    (await userManager.getSecretByWorkspaceId(scope, qboSecretKey(scope))) ??
    (await userManager.getSecretByWorkspaceId(scope, LEGACY_QBO_SECRET));
  if (persisted) {
    try {
      const parsed = JSON.parse(persisted) as QBOAuthTokens;
      if (parsed?.refresh_token) {
        tokensByScope.set(scope, parsed);
        return parsed;
      }
    } catch {
      // fall through to the error below
    }
  }

  throw new Error(`No QBO tokens found for scope=${scope}. Connect QuickBooks Online first.`);
}

async function refreshTokens(scope: string, tokens: QBOAuthTokens): Promise<QBOAuthTokens> {
  const resp = await fetch(`${QBO_OAUTH_BASE}/tokens/bearer`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId()}:${clientSecret()}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`QBO token refresh failed: ${resp.status} ${text}`);
  }

  const data = await resp.json();
  const updated: QBOAuthTokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    realm_id: tokens.realm_id,
    expires_at: Date.now() + (data.expires_in - 120) * 1000,
  };

  setQboTokens(scope, updated);
  return updated;
}

async function ensureTokens(scope: string): Promise<QBOAuthTokens> {
  let tokens = await loadTokens(scope);
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error("Not connected to QBO. Run a workflow with QBO Connect first.");
  }
  if (Date.now() >= tokens.expires_at) {
    tokens = await refreshTokens(scope, tokens);
  }
  return tokens;
}

async function apiRequest(
  scope: string,
  method: "GET" | "POST",
  url: string,
  params: Record<string, string>,
  body?: unknown,
): Promise<any> {
  const tryOne = async (apiBase: string) => {
    const tokens = await ensureTokens(scope);
    const fullUrl = `${apiBase}/v3/company/${tokens.realm_id}${url}`;
    const searchParams = new URLSearchParams(params);
    const qs = searchParams.toString();
    const target = `${fullUrl}${qs ? `?${qs}` : ""}`;

    const makeHeaders = (token: string) => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      return headers;
    };

    const doFetch = (token: string) =>
      fetch(target, {
        method,
        headers: makeHeaders(token),
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });

    let resp = await doFetch(tokens.access_token);

    if (resp.status === 401) {
      const refreshed = await refreshTokens(scope, tokens);
      resp = await doFetch(refreshed.access_token);
    }

    if (!resp.ok) {
      return { ok: false, status: resp.status, text: await resp.text() };
    }

    const text = await resp.text();
    let data: any = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    return { ok: true, data };
  };

  const result = await tryOne(QBO_AP_BASE_PROD);
  if (!result.ok) {
    const parsed: any = (() => { try { return JSON.parse(result.text!); } catch { return null; } })();
    const code = parsed?.fault?.error?.[0]?.code;
    const is3100 = code === "3100" || result.text?.includes("ApplicationAuthorizationFailed");

    if (is3100) {
      const sandboxResult = await tryOne(QBO_AP_BASE_SANDBOX);
      if (!sandboxResult.ok) {
        const sParsed: any = (() => { try { return JSON.parse(sandboxResult.text!); } catch { return null; } })();
        const sCode = sParsed?.fault?.error?.[0]?.code;
        const sMsg = sParsed?.fault?.error?.[0]?.message ?? sandboxResult.text;

        if (sCode === "3100" || sMsg?.includes("ApplicationAuthorizationFailed")) {
          throw new Error("QBO API authorization failed: Your Intuit app has not been granted access to this QBO company. Either use a sandbox company, or add this user as a Test User in the Intuit Developer portal (Keys & OAuth → Test users).");
        }
        if (sCode === "2700" || sMsg?.includes("InvalidToken")) {
          throw new Error("QBO access token is invalid. Try reconnecting: run the workflow again and re-authorize.");
        }
        throw new Error(`QBO API error (sandbox): ${sandboxResult.status} ${sandboxResult.text}`);
      }
      return sandboxResult.data;
    }

    if (code === "2700" || result.text?.includes("InvalidToken")) {
      throw new Error("QBO access token is invalid. Try reconnecting: run the workflow again and re-authorize.");
    }

    throw new Error(`QBO API error: ${result.status} ${result.text}`);
  }

  return result.data;
}

async function apiFetch(
  scope: string,
  url: string,
  params: Record<string, string>,
): Promise<any> {
  return apiRequest(scope, "GET", url, params);
}

export interface QBOAccount {
  Id: string;
  Name: string;
  AccountType: string;
  AccountSubType: string;
  Classification: string;
  CurrentBalance: number;
  Active: boolean;
}

export interface QBOJournalEntry {
  Id: string;
  TxnDate: string;
  Line: Array<{
    Id: string;
    Description: string;
    Amount: number;
    JournalEntryLineDetail: {
      PostingType: string;
      AccountRef: { value: string; name: string };
      ClassRef?: { value: string; name: string };
    };
  }>;
}

export interface QBOJournalEntryLineInput {
  Description?: string;
  Amount: number;
  DetailType: "JournalEntryLineDetail";
  JournalEntryLineDetail: {
    PostingType: "Debit" | "Credit";
    AccountRef: { value: string; name?: string };
    ClassRef?: { value: string; name?: string };
    DepartmentRef?: { value: string; name?: string };
    Entity?: { Type: string; EntityRef: { value: string; name?: string } };
  };
}

export interface QBOJournalEntryInput {
  TxnDate: string;
  PrivateNote?: string;
  DocNumber?: string;
  Line: QBOJournalEntryLineInput[];
}

export interface QBOClass {
  Id: string;
  Name: string;
  Active: boolean;
}

export interface QBOItem {
  Id: string;
  Name: string;
  Type: string;
  Active: boolean;
  Description?: string;
  UnitPrice?: number;
  FullyQualifiedName?: string;
}

export interface QBODepartment {
  Id: string;
  Name: string;
  Active: boolean;
}

export interface QBOVendor {
  Id: string;
  DisplayName: string;
  CompanyName: string;
  Active: boolean;
}

export interface QBOCustomer {
  Id: string;
  DisplayName: string;
  CompanyName: string;
  Active: boolean;
}

export interface QBOBill {
  Id: string;
  TxnDate: string;
  DueDate: string;
  VendorRef: { value: string; name: string };
  TotalAmt: number;
  Balance: number;
}

export interface QBOInvoice {
  Id: string;
  TxnDate: string;
  DueDate: string;
  CustomerRef: { value: string; name: string };
  TotalAmt: number;
  Balance: number;
}

export interface QBOPurchase {
  Id: string;
  TxnDate: string;
  AccountRef: { value: string; name: string };
  TotalAmt: number;
  PaymentType: string;
  EntityRef?: { value: string; name: string; type: string };
}

export class QBOClient {
  private scope: string;
  private realmId: string | null = null;

  constructor(scope: string) {
    this.scope = scope;
  }

  async connect(): Promise<void> {
    const tokens = await loadTokens(this.scope);
    this.realmId = tokens.realm_id;
  }

  isConnected(): boolean {
    return this.realmId !== null;
  }

  async query(entity: string, opts?: QBOQueryOpts): Promise<{ QueryResponse: any }> {
    const q = `SELECT ${opts?.select ?? "*"} FROM ${entity}${opts?.where ? ` WHERE ${opts.where}` : ""}${opts?.orderBy ? ` ORDER BY ${opts.orderBy}` : ""}${opts?.maxResults ? ` MAXRESULTS ${opts.maxResults}` : ""}`;
    return apiFetch(this.scope, "/query", { query: q });
  }

  async report(name: string, params?: Record<string, string>): Promise<any> {
    return apiFetch(this.scope, `/reports/${name}`, { ...params });
  }

  async accounts(): Promise<QBOAccount[]> {
    const result = await this.query("Account", { where: "Active IN (true, false)", maxResults: 1000 });
    return result.QueryResponse.Account ?? [];
  }

  async companyInfo(): Promise<{ CompanyName: string } | null> {
    const result = await this.query("CompanyInfo", { maxResults: 1 });
    const list = result.QueryResponse?.CompanyInfo;
    if (!Array.isArray(list) || list.length === 0) return null;
    return list[0];
  }

  async journalEntries(maxResults = 200): Promise<QBOJournalEntry[]> {
    const result = await this.query("JournalEntry", {
      select: "*",
      orderBy: "TxnDate DESC",
      maxResults,
    });
    return result.QueryResponse.JournalEntry ?? [];
  }

  async createJournalEntry(entry: QBOJournalEntryInput): Promise<any> {
    return apiRequest(this.scope, "POST", "/journalentry", {}, entry);
  }

  async classes(): Promise<QBOClass[]> {
    const result = await this.query("Class", { maxResults: 1000 });
    return result.QueryResponse.Class ?? [];
  }

  async departments(): Promise<QBODepartment[]> {
    const result = await this.query("Department", { maxResults: 1000 });
    return result.QueryResponse.Department ?? [];
  }

  async items(maxResults = 1000): Promise<QBOItem[]> {
    const result = await this.query("Item", { maxResults });
    return result.QueryResponse.Item ?? [];
  }

  async vendors(): Promise<QBOVendor[]> {
    const result = await this.query("Vendor", { maxResults: 1000 });
    return result.QueryResponse.Vendor ?? [];
  }

  async customers(): Promise<QBOCustomer[]> {
    const result = await this.query("Customer", { maxResults: 1000 });
    return result.QueryResponse.Customer ?? [];
  }

  async bills(maxResults = 200): Promise<QBOBill[]> {
    const result = await this.query("Bill", { orderBy: "TxnDate DESC", maxResults });
    return result.QueryResponse.Bill ?? [];
  }

  async invoices(maxResults = 200): Promise<QBOInvoice[]> {
    const result = await this.query("Invoice", { orderBy: "TxnDate DESC", maxResults });
    return result.QueryResponse.Invoice ?? [];
  }

  async purchases(maxResults = 200): Promise<QBOPurchase[]> {
    const result = await this.query("Purchase", { orderBy: "TxnDate DESC", maxResults });
    return result.QueryResponse.Purchase ?? [];
  }

  async trialBalance(date?: string): Promise<any> {
    const params: Record<string, string> = {};
    if (date) params.date_macro = date;
    return this.report("TrialBalance", params);
  }

  async profitAndLoss(
    startDate: string,
    endDate: string,
    options?: { summarizeColumnBy?: string; accountingMethod?: string },
  ): Promise<any> {
    const params: Record<string, string> = {
      start_date: startDate,
      end_date: endDate,
    };
    if (options?.summarizeColumnBy) params.summarize_column_by = options.summarizeColumnBy;
    if (options?.accountingMethod) params.accounting_method = options.accountingMethod;
    return this.report("ProfitAndLoss", params);
  }

  async balanceSheet(
    startDate: string,
    endDate: string,
    options?: { summarizeColumnBy?: string; accountingMethod?: string },
  ): Promise<any> {
    const params: Record<string, string> = {
      start_date: startDate,
      end_date: endDate,
    };
    if (options?.summarizeColumnBy) params.summarize_column_by = options.summarizeColumnBy;
    if (options?.accountingMethod) params.accounting_method = options.accountingMethod;
    return this.report("BalanceSheet", params);
  }
}

export async function checkQBOConnected(scope: string): Promise<boolean> {
  try {
    const tokens = await loadTokens(scope);
    return tokens.refresh_token.length > 0;
  } catch (err: any) {
    console.log(`[checkQBOConnected] scope=${scope}: ${err.message}`);
    return false;
  }
}

/** Hydrated lookup for UI/status rendering — reads through to the vault so the
 *  connection card is correct right after a process restart. */
export async function getQboTokensHydrated(scope: string): Promise<QBOAuthTokens | null> {
  try {
    return await loadTokens(scope);
  } catch {
    return null;
  }
}
