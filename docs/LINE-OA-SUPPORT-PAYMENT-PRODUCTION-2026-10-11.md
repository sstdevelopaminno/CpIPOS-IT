# LINE OA Support / Payment configuration

Production web: https://cp-ipos-it-web.vercel.app

The LINE Login channel ID configured by default is 2011852850.
The shared LIFF ID configured by default is 2011852850-5tjQo09l.

## LINE channel status

For customers to use LINE Login, the LINE Login channel must be **Published** in LINE Developers. A channel in **Developing** can only be used by its Admin or Tester accounts. A LINE 400 page mentioning Developing is a LINE account/channel permission issue, not a Vercel build error.

## Shared LIFF setup

Set the single LIFF app Endpoint URL to:
https://cp-ipos-it-web.vercel.app/support/line

Enable **openid** and **profile** scopes.

LINE OA Rich Menu links:

- IT Support: https://liff.line.me/2011852850-5tjQo09l
- Payment Center: https://liff.line.me/2011852850-5tjQo09l/payment

The Payment URI appends /payment beneath the shared LIFF endpoint and opens:
https://cp-ipos-it-web.vercel.app/support/line/payment

Optionally, configure a different payment LIFF app in the same LINE Login channel and set NEXT_PUBLIC_LINE_PAYMENT_LIFF_ID in the IT web deployment to its real LIFF ID. The default uses the shared LIFF ID. Do not use a second ID until it has been configured in LINE Developers.

## Verification

Test both OA menu links with a LINE account that is not a LINE Developers Admin or Tester, checking that each opens the correct page. Support must request store-code/Owner OTP when appropriate. Payment must open Payment Center rather than Support.

Official documentation:
https://developers.line.biz/en/docs/line-login/getting-started/
https://developers.line.biz/en/docs/liff/opening-liff-app/
