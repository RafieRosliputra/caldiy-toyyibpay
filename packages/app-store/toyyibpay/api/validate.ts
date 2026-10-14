import type { NextApiRequest, NextApiResponse } from "next";
import { getToyyibpayCategoryDetails, isToyyibpayDuitNowQRActivated } from "../lib/toyyibpayClient";
import { toyyibpayCredentialKeysSchema } from "../lib/toyyibpayCredentialKeysSchema";

/**
 * Validates the credentials entered in the setup page before they are saved:
 * the secret key must be valid and the category must belong to that account.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!req.session?.user?.id) {
    return res.status(401).json({ message: "You must be logged in to do this" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  const parsed = toyyibpayCredentialKeysSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid ToyyibPay credentials" });
  }

  const credentials = parsed.data;
  const account = credentials.isSandbox ? credentials.sandbox : credentials.prod;
  if (!account?.secretKey || !account?.categoryCode) {
    return res.status(400).json({ message: "Secret key and category code are required" });
  }

  try {
    const category = await getToyyibpayCategoryDetails({
      secretKey: account.secretKey,
      categoryCode: account.categoryCode,
      isSandbox: credentials.isSandbox,
    });

    if (!category) {
      return res.status(400).json({ message: "ToyyibPay category not found for this secret key" });
    }

    const duitNowActivated = credentials.enableDuitNowQR
      ? await isToyyibpayDuitNowQRActivated({
          secretKey: account.secretKey,
          isSandbox: credentials.isSandbox,
        })
      : undefined;

    return res.status(200).json({
      categoryName: category.categoryName,
      categoryStatus: category.categoryStatus,
      duitNowActivated,
    });
  } catch (error) {
    return res.status(400).json({
      message: error instanceof Error ? error.message : "Could not validate the ToyyibPay credentials",
    });
  }
}
