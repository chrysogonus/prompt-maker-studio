/** A pending OAuth authorization request, as shown on the consent screen. */
export interface OAuthConsentDetails {
  client_name: string;
  redirect_host: string;
}

/** Where to send the browser after the user approves or denies. */
export interface OAuthConsentResult {
  redirect_url: string;
}
