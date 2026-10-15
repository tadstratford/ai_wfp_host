export interface ContactMessage {
    id: string;
    name: string;
    email: string;
    message: string;
    created_at: string;
}

export type CreateContactMessageParams = Omit<ContactMessage, "id" | "created_at">;
