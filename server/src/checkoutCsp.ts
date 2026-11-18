// PayPal SDK v6 requires externally hosted scripts, network access and
// PayPal-hosted card iframes. Keep these permissions on /checkout only.
// The rest of the account app retains Helmet's restrictive default CSP.
export const CHECKOUT_PAYMENT_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "script-src 'self' https://*.paypal.com https://*.paypalobjects.com https://applepay.cdn-apple.com",
  "frame-src 'self' https://*.paypal.com https://*.paypalobjects.com",
  "connect-src 'self' https://*.paypal.com https://*.paypalobjects.com",
  "img-src 'self' data: https://*.paypal.com https://*.paypalobjects.com",
  "style-src 'self' 'unsafe-inline' https://*.paypal.com https://*.paypalobjects.com https://fonts.googleapis.com",
  "font-src 'self' data: https://*.paypalobjects.com https://fonts.gstatic.com",
  "form-action 'self' https://*.paypal.com"
].join('; ')
