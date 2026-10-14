"use client";

import { useEffect } from "react";
import { z } from "zod";

const PaymentToyyibpayDataSchema = z.object({
  billCode: z.string(),
  paymentUrl: z.string(),
  bookingUid: z.string(),
  bookerEmail: z.string().optional(),
  eventTypeSlug: z.string().nullable().optional(),
  bookingUserName: z.string().nullable().optional(),
});

interface IPaymentComponentProps {
  payment: {
    data: unknown;
  };
}

export const ToyyibpayPaymentComponent = (props: IPaymentComponentProps) => {
  const parsedData = PaymentToyyibpayDataSchema.safeParse(props.payment.data);
  const paymentUrl = parsedData.success ? parsedData.data.paymentUrl : null;

  useEffect(() => {
    if (paymentUrl) {
      window.location.href = paymentUrl;
    }
  }, [paymentUrl]);

  if (!paymentUrl) {
    return <p className="mt-3 text-center">Couldn&apos;t obtain the ToyyibPay payment URL</p>;
  }

  return (
    <div className="mt-3 text-center">
      <p>Redirecting you to ToyyibPay…</p>
      <a className="text-emphasis underline" href={paymentUrl}>
        Klik di sini jika anda tidak dialihkan secara automatik
      </a>
    </div>
  );
};
