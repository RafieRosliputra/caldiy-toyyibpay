export { default } from "@calcom/app-store/toyyibpay/api/webhook";

// Must be a literal object in the route file: Next statically parses it at build time.
// ToyyibPay posts the bill callback as multipart/form-data, which the default body parser cannot decode.
export const config = {
  api: {
    bodyParser: false,
  },
};
