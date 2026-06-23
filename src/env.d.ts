interface ImportMetaEnv {
  readonly TWILIO_ACCOUNT_SID: string;
  readonly TWILIO_AUTH_TOKEN: string;
  readonly TWILIO_FROM_NUMBER: string;
  readonly ADMIN_NUMBERS: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
