import { getPaymentCurrency } from "@calcom/app-store/_utils/payments/getPaymentCurrency";
import { APP_NAME } from "@calcom/lib/constants";
import logger from "@calcom/lib/logger";
import prisma from "@calcom/prisma";
import { buildLegacyCtx } from "@lib/buildLegacyCtx";
import type { PageProps } from "app/_types";
import { _generateMetadata } from "app/_utils";
import { withAppDirSsr } from "app/WithAppDirSsr";
import { cookies, headers } from "next/headers";
import PaymentPage from "./PaymentPage";

const log = logger.getSubLogger({ prefix: ["payment-page"] });

type PaymentPageProps = {
  payment: {
    id: number;
    success: boolean;
    refunded: boolean;
    amount: number;
    currency: string;
    paymentOption: string | null;
    data: Record<string, unknown>;
    appId?: string | null;
  };
  clientSecret?: string | null;
  booking: {
    id: number;
    uid: string;
    title: string;
    startTime: string;
    endTime: string;
    status: string;
    paid: boolean;
    description?: string | null;
    location?: string | null;
  };
  eventType: {
    id: number;
    title: string;
    length: number;
    price: number;
    currency: string;
    metadata: Record<string, unknown> | null;
    successRedirectUrl?: string | null;
    forwardParamsSuccessRedirect?: boolean | null;
    recurringEvent?: unknown;
  };
  profile: { theme?: string | null; hideBranding?: boolean };
  user?: { name?: string | null; username?: string | null } | null;
};

/**
 * Loads the payment (and its booking + event type) that the booker is asked to pay for.
 *
 * The community edition has no payment data loader of its own, so this is implemented here: without it the
 * page rendered with empty props and `getPaymentAppData()` threw while parsing a `null` metadata object,
 * which surfaced as the generic "It's not you, it's us" error page.
 */
const getData = withAppDirSsr<PaymentPageProps>(async (context) => {
  const uidParam = context.query?.uid;
  const uid = Array.isArray(uidParam) ? uidParam[0] : uidParam;

  if (!uid) return { notFound: true } as const;

  const payment = await prisma.payment.findFirst({
    where: { uid },
    select: {
      id: true,
      success: true,
      refunded: true,
      amount: true,
      currency: true,
      paymentOption: true,
      data: true,
      appId: true,
      booking: {
        select: {
          id: true,
          uid: true,
          title: true,
          description: true,
          startTime: true,
          endTime: true,
          status: true,
          paid: true,
          location: true,
          eventType: {
            select: {
              id: true,
              title: true,
              length: true,
              price: true,
              currency: true,
              metadata: true,
              successRedirectUrl: true,
              forwardParamsSuccessRedirect: true,
              recurringEvent: true,
              owner: { select: { name: true, username: true, theme: true, hideBranding: true } },
              team: { select: { hideBranding: true } },
            },
          },
        },
      },
    },
  });

  const booking = payment?.booking;
  const eventType = booking?.eventType;

  if (!booking || !eventType) {
    log.warn(`Payment ${uid} not found, or its booking has no event type`);
    return { notFound: true } as const;
  }

  const owner = eventType.owner;

  return {
    props: {
      payment: {
        id: payment.id,
        success: payment.success,
        refunded: payment.refunded,
        amount: payment.amount,
        currency: payment.currency,
        paymentOption: payment.paymentOption,
        appId: payment.appId,
        data: (payment.data ?? {}) as unknown as Record<string, unknown>,
      },
      booking: {
        id: booking.id,
        uid: booking.uid,
        title: booking.title,
        description: booking.description,
        startTime: booking.startTime.toISOString(),
        endTime: booking.endTime.toISOString(),
        status: booking.status,
        paid: booking.paid,
        location: booking.location,
      },
      eventType: {
        id: eventType.id,
        title: eventType.title,
        length: eventType.length,
        price: eventType.price,
        currency: getPaymentCurrency(eventType),
        // `getPaymentAppData()` parses this with a Zod schema, which throws on `null`. Event types created
        // before metadata existed can have `metadata: null`, so fall back to an empty object.
        metadata: (eventType.metadata ?? {}) as unknown as Record<string, unknown>,
        successRedirectUrl: eventType.successRedirectUrl,
        forwardParamsSuccessRedirect: eventType.forwardParamsSuccessRedirect,
        recurringEvent: eventType.recurringEvent ?? null,
      },
      profile: {
        theme: owner?.theme ?? null,
        hideBranding: eventType.team?.hideBranding ?? owner?.hideBranding ?? false,
      },
      user: owner ? { name: owner.name, username: owner.username } : null,
    },
  };
});

export const generateMetadata = async ({ params, searchParams }: PageProps) => {
  const props = await getData(
    buildLegacyCtx(await headers(), await cookies(), await params, await searchParams)
  );
  const eventName = props.booking.title;
  return await _generateMetadata(
    (t) => `${t("payment")} | ${eventName} | ${APP_NAME}`,
    () => "",
    undefined,
    undefined,
    `/payment/${(await params).uid}`
  );
};

const ServerPage = async ({ params, searchParams }: PageProps) => {
  const props = await getData(
    buildLegacyCtx(await headers(), await cookies(), await params, await searchParams)
  );

  return <PaymentPage {...props} />;
};
export default ServerPage;
