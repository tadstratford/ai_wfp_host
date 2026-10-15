import { select } from "@backend/core/admin/supabase";
import type { UsageSummary } from "./usageTracker";

/**
 * Query usage summary from Supabase llm_usage table.
 */
export async function queryUsageSummary(
    userId: string | null,
    since?: string,
    until?: string
): Promise<{ data: UsageSummary | null }> {
    if (!userId) return { data: null };

    try {
        // Fetch recent calls for this user (PostgREST doesn't do aggregates easily,
        // so we fetch raw rows and aggregate in JS)
        const { data: rows, error } = await select(
            "llm_usage",
            { user_id: userId },
            "id,source,model,input_tokens,output_tokens,cost_usd,success,created_at"
        );

        if (error || !rows) return { data: null };

        // Filter by date range if provided
        let filtered = rows.filter((r: any) => r.success === 1);
        if (since) filtered = filtered.filter((r: any) => r.created_at >= since);
        if (until) filtered = filtered.filter((r: any) => r.created_at <= until);

        // Aggregate totals
        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        let totalCostUsd = 0;
        const sourceMap = new Map<string, { inputTokens: number; outputTokens: number; costUsd: number; calls: number }>();
        const modelMap = new Map<string, { inputTokens: number; outputTokens: number; costUsd: number; calls: number }>();

        for (const r of filtered) {
            totalInputTokens += r.input_tokens || 0;
            totalOutputTokens += r.output_tokens || 0;
            totalCostUsd += r.cost_usd || 0;

            const src = sourceMap.get(r.source) || { inputTokens: 0, outputTokens: 0, costUsd: 0, calls: 0 };
            src.inputTokens += r.input_tokens || 0;
            src.outputTokens += r.output_tokens || 0;
            src.costUsd += r.cost_usd || 0;
            src.calls++;
            sourceMap.set(r.source, src);

            const mdl = modelMap.get(r.model) || { inputTokens: 0, outputTokens: 0, costUsd: 0, calls: 0 };
            mdl.inputTokens += r.input_tokens || 0;
            mdl.outputTokens += r.output_tokens || 0;
            mdl.costUsd += r.cost_usd || 0;
            mdl.calls++;
            modelMap.set(r.model, mdl);
        }

        const bySource = [...sourceMap.entries()]
            .map(([source, v]) => ({ source, ...v }))
            .sort((a, b) => b.costUsd - a.costUsd);

        const byModel = [...modelMap.entries()]
            .map(([model, v]) => ({ model, ...v }))
            .sort((a, b) => b.costUsd - a.costUsd);

        // Recent calls (last 50)
        const recentCalls = filtered
            .sort((a: any, b: any) => b.created_at.localeCompare(a.created_at))
            .slice(0, 50)
            .map((r: any) => ({
                id: r.id,
                source: r.source,
                model: r.model,
                inputTokens: r.input_tokens,
                outputTokens: r.output_tokens,
                costUsd: r.cost_usd,
                createdAt: r.created_at,
            }));

        return {
            data: {
                totalInputTokens,
                totalOutputTokens,
                totalCostUsd,
                callCount: filtered.length,
                bySource,
                byModel,
                recentCalls,
            },
        };
    } catch (err) {
        console.error("[UsageQuery] Error:", err);
        return { data: null };
    }
}
