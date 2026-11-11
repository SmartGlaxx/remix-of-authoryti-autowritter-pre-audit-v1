// Admin-only visibility (e.g. real-author mappings behind writer avatars).
export const ADMIN_EMAILS = ["mailsmartcodes@gmail.com"];
export const isAdminEmail = (email?: string | null) => !!email && ADMIN_EMAILS.includes(email.toLowerCase());
