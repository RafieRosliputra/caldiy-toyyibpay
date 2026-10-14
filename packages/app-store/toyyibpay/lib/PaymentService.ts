import process from "node:process";
import dayjs from "@calcom/dayjs";
import tasker from "@calcom/features/tasker";
import { WEBAPP_URL } from "@calcom/lib/constants";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import logger from "@calcom/lib/logger";
import { safeStringify } from "@calcom/lib/safeStringify";
import prisma from "@calcom/prisma";
import type { Booking, Payment, PaymentOption, Prisma } from "@calcom/prisma/client";
import type { EventTypeMetadata } from "@calcom/prisma/zod-utils";
import type { CalendarEvent } from "@calcom/types/Calendar";
import type { IAbstractPaymentService } from "@calcom/types/PaymentService";
import { v4 as uuidv4 } from "uuid";
import appConfig from "../config.json";
import { DEFAULT_PAYMENT_HOLD_MINUTES, TOYYIBPAY_SUPPORTED_CURRENCY } from "./constants";
import {
  createToyyibpayBill,
  formatToyyibpayExpiryDate,
  normalizeToyyibpayPhone,
  resolveToyyibpayAccount,
} from "./toyyibpayClient";
import type { ToyyibpayCredentials } from "./toyyibpayCredentialKeysSchema";
import { toyyibpayCredentialKeysSchema } from "./toyyibpayCredentialKeysSchema";
import type { ToyyibpayPaymentData } from "./toyyibpayPaymentDataSchema";

const log = logger.getSubLogger({ prefix: ["payment-service:toyyibpay"] });

class ToyyibpayPaymentService implements IAbstractPaymentService {
  private credentials: ToyyibpayCredentials | null;

  constructor(credentials: { key: Prisma.JsonValue }) {
    const keyParsing = toyyibpayCredentialKeysSchema.safeParse(credentials.key);
    this.credentials = keyParsing.success ? keyParsing.data : null;
  }

  async create(
    payment: Pick<Prisma.PaymentUncheckedCreateInput, "amount" | "currency">,
    bookingId: Booking["id"],
    _userId: Booking["userId"],
    username: string | null,
    bookerName: string | null,
    _paymentOption: PaymentOption,
    bookerEmail: string,
    bookerPhoneNumber?: string | null,
    eventTitle?: string,
    bookingTitle?: string
  ): Promise<Payment> {
    try {
      if (!this.credentials) {
        throw new ErrorWithCode(ErrorCode.PaymentCreationFailure, "ToyyibPay credentials are not configured");
      }

      const account = resolveToyyibpayAccount(this.credentials);

      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        select: {
          uid: true,
          title: true,
          startTime: true,
          endTime: true,
          eventTypeId: true,
          eventType: {
            select: {
              slug: true,
              seatsPerTimeSlot: true,
            },
          },
          attendees: { select: { bookingSeat: { select: { id: true } } } },
        },
      });

      if (!booking) {
        throw new ErrorWithCode(ErrorCode.BookingNotFound, `Booking ${bookingId} not found`);
      }

      const { startTime, endTime, eventTypeId } = booking;

      const bookingsWithSameTimeSlot = await prisma.booking.findMany({
        where: {
          eventTypeId,
          startTime,
          endTime,
          OR: [{ status: "PENDING" }, { status: "AWAITING_HOST" }],
        },
        select: { uid: true, title: true },
      });

      if (booking.eventType?.seatsPerTimeSlot) {
        const seatsTaken =
          booking.attendees.filter((attendee) => !!attendee.bookingSeat).length +
          Math.max(bookingsWithSameTimeSlot.length - 1, 0);
        if (seatsTaken > booking.eventType.seatsPerTimeSlot) {
          throw new ErrorWithCode(ErrorCode.BookingSeatsFull, "No seats left for this time slot");
        }
      } else if (bookingsWithSameTimeSlot.length > 1) {
        throw new ErrorWithCode(ErrorCode.NoAvailableUsersFound, "This time slot is no longer available");
      }

      const currency = (payment.currency || TOYYIBPAY_SUPPORTED_CURRENCY).toUpperCase();
      if (currency !== TOYYIBPAY_SUPPORTED_CURRENCY) {
        throw new ErrorWithCode(
          ErrorCode.PaymentCreationFailure,
          `ToyyibPay only supports ${TOYYIBPAY_SUPPORTED_CURRENCY} payments, received ${currency}`
        );
      }

      const billAmount = Math.round(payment.amount);
      if (billAmount <= 0) {
        throw new ErrorWithCode(
          ErrorCode.PaymentCreationFailure,
          "ToyyibPay bill amount must be greater than 0"
        );
      }

      const holdMinutes =
        Number(process.env.AWAITING_PAYMENT_EMAIL_DELAY_MINUTES) || DEFAULT_PAYMENT_HOLD_MINUTES;
      const billExpiryDate = formatToyyibpayExpiryDate(dayjs().add(holdMinutes, "minutes").toDate());

      const reference = uuidv4();
      const returnUrl = `${WEBAPP_URL}/api/integrations/${appConfig.slug}/callback?ref=${reference}`;
      const callbackUrl = `${WEBAPP_URL}/api/integrations/${appConfig.slug}/webhook`;

      const billPhone = normalizeToyyibpayPhone(bookerPhoneNumber);
      const { billCode, paymentUrl } = await createToyyibpayBill({
        account,
        billName: bookingTitle || booking.title || eventTitle || `Booking ${bookingId}`,
        billDescription: `Booking on ${dayjs(startTime).format("DD MMM YYYY HH:mm")}`,
        billAmount,
        billReturnUrl: returnUrl,
        billCallbackUrl: callbackUrl,
        billExternalReferenceNo: reference,
        billTo: billPhone ? bookerName : null,
        billEmail: billPhone ? bookerEmail : null,
        billPhone,
        billPaymentChannel: this.credentials.paymentChannel,
        enableDuitNowQR: this.credentials.enableDuitNowQR,
        billExpiryDate,
      });

      const toyyibpayPaymentData: ToyyibpayPaymentData = {
        billCode,
        paymentUrl,
        returnUrl,
        callbackUrl,
        isSandbox: account.isSandbox,
        billExpiryDate,
        bookingUid: booking.uid,
        eventTypeSlug: booking.eventType?.slug ?? null,
        bookingUserName: username,
        bookerName,
        bookerEmail,
        bookerPhoneNumber: bookerPhoneNumber ?? null,
        isPaid: false,
      };

      const storedPayment = await prisma.payment.create({
        data: {
          uid: reference,
          app: { connect: { slug: appConfig.slug } },
          booking: { connect: { id: bookingId } },
          amount: billAmount,
          currency: TOYYIBPAY_SUPPORTED_CURRENCY,
          externalId: billCode,
          fee: 0,
          refunded: false,
          success: false,
          data: toyyibpayPaymentData as unknown as Prisma.InputJsonValue,
        },
      });

      if (!storedPayment) {
        throw new ErrorWithCode(ErrorCode.PaymentCreationFailure, "Failed to store the ToyyibPay payment");
      }

      log.debug(`Created ToyyibPay bill ${billCode} for booking ${bookingId} (expires ${billExpiryDate})`);
      return storedPayment;
    } catch (error: unknown) {
      log.error("ToyyibPay payment could not be created", bookingId, safeStringify(error));

      if (
        error instanceof ErrorWithCode &&
        (error.code === ErrorCode.BookingSeatsFull || error.code === ErrorCode.NoAvailableUsersFound)
      ) {
        throw error;
      }

      try {
        await prisma.booking.update({
          where: { id: bookingId },
          data: { status: "CANCELLED" },
        });
      } catch (cancellationError) {
        log.error(
          "Could not cancel booking after payment creation failure",
          bookingId,
          safeStringify(cancellationError)
        );
      }

      if (error instanceof ErrorWithCode) throw error;
      throw new ErrorWithCode(
        ErrorCode.PaymentCreationFailure,
        error instanceof Error ? error.message : "ToyyibPay payment could not be created"
      );
    }
  }

  async update(
    paymentId: Payment["id"],
    data: Partial<Prisma.PaymentUncheckedCreateInput>
  ): Promise<Payment> {
    return prisma.payment.update({ where: { id: paymentId }, data });
  }

  async refund(): Promise<Payment | null> {
    throw new ErrorWithCode(
      ErrorCode.BadRequest,
      "ToyyibPay does not expose a refund API. Deactivate the bill with inactiveBill and refund the payment manually from your ToyyibPay dashboard."
    );
  }

  async collectCard(): Promise<Payment> {
    throw new ErrorWithCode(
      ErrorCode.CollectCardFailure,
      "ToyyibPay does not support collecting cards for later charges"
    );
  }

  async chargeCard(): Promise<Payment> {
    throw new ErrorWithCode(ErrorCode.ChargeCardFailure, "ToyyibPay does not support charging a stored card");
  }

  async getPaymentPaidStatus(): Promise<string> {
    throw new ErrorWithCode(ErrorCode.BadRequest, "Not implemented for ToyyibPay");
  }

  async getPaymentDetails(): Promise<Payment> {
    throw new ErrorWithCode(ErrorCode.BadRequest, "Not implemented for ToyyibPay");
  }

  /**
   * ToyyibPay bills expire by themselves (`billExpiryDate`) but the booking has to be released too,
   * so we schedule the same awaiting-payment task Cal.com uses for other redirect based gateways.
   */
  async afterPayment(
    event: CalendarEvent,
    booking: {
      user: { email: string | null; name: string | null; timeZone: string } | null;
      id: number;
      startTime: { toISOString: () => string };
      uid: string;
    },
    paymentData: Payment,
    _eventTypeMetadata?: EventTypeMetadata
  ): Promise<void> {
    const delayMinutes =
      Number(process.env.AWAITING_PAYMENT_EMAIL_DELAY_MINUTES) || DEFAULT_PAYMENT_HOLD_MINUTES;
    const scheduledEmailAt = dayjs().add(delayMinutes, "minutes").toDate();

    try {
      await tasker.create(
        "sendAwaitingPaymentEmail",
        {
          bookingId: booking.id,
          paymentId: paymentData.id,
          attendeeSeatId: event.attendeeSeatId || null,
        },
        {
          scheduledAt: scheduledEmailAt,
          referenceUid: booking.uid,
        }
      );
    } catch (error) {
      log.error("Could not schedule the awaiting payment email", booking.id, safeStringify(error));
    }
  }

  async deletePayment(paymentId: Payment["id"]): Promise<boolean> {
    try {
      await prisma.payment.delete({ where: { id: paymentId } });
      return true;
    } catch (error) {
      log.error("Could not delete ToyyibPay payment", paymentId, safeStringify(error));
      return false;
    }
  }

  isSetupAlready(): boolean {
    return !!this.credentials;
  }
}

/**
 * Factory function that creates a ToyyibPay Payment service instance.
 * This is exported instead of the class to prevent internal types
 * from leaking into the emitted .d.ts file.
 */
export function BuildPaymentService(credentials: { key: Prisma.JsonValue }): IAbstractPaymentService {
  return new ToyyibpayPaymentService(credentials);
}
