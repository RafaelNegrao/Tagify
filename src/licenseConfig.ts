// Backend de licença (Supabase Edge Functions).
//
// Preencha depois de publicar as funções (supabase functions deploy ...):
//   SUPABASE_FUNCTIONS_URL = "https://<SEU_REF>.supabase.co/functions/v1"
//   SUPABASE_ANON_KEY      = "<anon public key>"  (é pública, pode versionar)
//
// Enquanto estiverem vazias, o app usa só a ativação OFFLINE (chave do keygen).
export const SUPABASE_FUNCTIONS_URL = "";
export const SUPABASE_ANON_KEY = "";

export const onlineLicensingEnabled = (): boolean =>
  SUPABASE_FUNCTIONS_URL.trim().length > 0 && SUPABASE_ANON_KEY.trim().length > 0;
