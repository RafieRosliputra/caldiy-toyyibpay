import AppNotInstalledMessage from "@calcom/app-store/_components/AppNotInstalledMessage";
import KeyField from "@calcom/app-store/toyyibpay/components/KeyInput";
import { toyyibpayCredentialKeysSchema } from "@calcom/app-store/toyyibpay/lib/toyyibpayCredentialKeysSchema";
import type { IToyyibpaySetupProps } from "@calcom/app-store/toyyibpay/pages/setup/_getServerSideProps";
import { WEBAPP_URL } from "@calcom/lib/constants";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { trpc } from "@calcom/trpc/react";
import { Button } from "@calcom/ui/components/button";
import { CheckboxField, Select } from "@calcom/ui/components/form";
import { showToast } from "@calcom/ui/components/toast";
import { LoaderIcon } from "@coss/ui/icons";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Toaster } from "sonner";
import { z } from "zod";

const paymentChannelOptions = [
  { label: "FPX (online banking)", value: "0" },
  { label: "Credit / debit card", value: "1" },
  { label: "FPX + credit / debit card", value: "2" },
] as const;

const settingsSchema = z.object({
  secretKey: z.string().trim().min(1, "Secret key is required"),
  categoryCode: z.string().trim().min(1, "Category code is required"),
  isSandbox: z.boolean(),
  enableDuitNowQR: z.boolean(),
  paymentChannel: z.enum(["0", "1", "2"]),
});

type SettingsSchema = z.infer<typeof settingsSchema>;

export default function ToyyibpaySetup(props: IToyyibpaySetupProps) {
  const router = useRouter();
  const { t } = useLocale();
  const session = useSession();
  const [loading, setLoading] = useState(false);

  const webhookUrl = `${WEBAPP_URL}/api/integrations/toyyibpay/webhook`;

  const integrations = trpc.viewer.apps.integrations.useQuery({ variant: "payment", appId: "toyyibpay" });
  const [toyyibpayCredentials] = integrations.data?.items || [];
  const [credentialId] = toyyibpayCredentials?.userCredentialIds || [-1];
  const showContent = !!integrations.data && integrations.isSuccess && !!credentialId;

  const saveKeysMutation = trpc.viewer.apps.updateAppCredentials.useMutation({
    onSuccess: () => {
      showToast(t("keys_have_been_saved"), "success");
      router.push("/event-types");
    },
    onError: (error) => {
      showToast(error.message, "error");
    },
  });

  const deleteMutation = trpc.viewer.credentials.delete.useMutation({
    onSuccess: () => {
      router.push("/apps/toyyibpay");
    },
    onError: () => {
      showToast(t("error_removing_app"), "error");
    },
  });

  const existingEnvKeys = props.isSandbox ? props.sandbox : props.prod;

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<SettingsSchema>({
    reValidateMode: "onChange",
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      secretKey: existingEnvKeys?.secretKey || "",
      categoryCode: existingEnvKeys?.categoryCode || "",
      isSandbox: props.isSandbox ?? false,
      enableDuitNowQR: props.enableDuitNowQR ?? false,
      paymentChannel: props.paymentChannel ?? "2",
    },
  });

  const selectedChannel = watch("paymentChannel");
  const isNewCredential = !props.prod?.secretKey && !props.sandbox?.secretKey;

  const onSubmit = handleSubmit(async (data) => {
    if (loading) return;
    setLoading(true);

    const enteredAccount = { secretKey: data.secretKey, categoryCode: data.categoryCode };
    const newKeys = toyyibpayCredentialKeysSchema.parse({
      isSandbox: data.isSandbox,
      enableDuitNowQR: data.enableDuitNowQR,
      paymentChannel: data.paymentChannel,
      prod: data.isSandbox ? props.prod : enteredAccount,
      sandbox: data.isSandbox ? enteredAccount : props.sandbox,
    });

    try {
      const response = await fetch("/api/integrations/toyyibpay/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newKeys),
      });
      const result = (await response.json()) as { message?: string; categoryName?: string };

      if (!response.ok) {
        showToast(result.message || "Could not validate the ToyyibPay credentials", "error");
        return;
      }

      saveKeysMutation.mutate({ credentialId, key: newKeys });
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Could not validate the ToyyibPay credentials",
        "error"
      );
    } finally {
      setLoading(false);
    }
  });

  const onCancel = () => {
    deleteMutation.mutate({ id: credentialId });
  };

  if (session.status === "loading") return <></>;

  if (integrations.isPending) {
    return <div className="absolute z-50 flex h-screen w-full items-center bg-gray-200" />;
  }

  return (
    <div className="bg-default flex h-screen items-center justify-center">
      {showContent ? (
        <div className="flex w-full max-w-[43em] flex-col items-center justify-center stack-y-4 p-4 lg:stack-y-5">
          <form className="w-full stack-y-4" onSubmit={onSubmit}>
            <div className="bg-default border-subtle overflow-auto rounded border">
              <div className="border-subtle flex items-center justify-between border-b p-4 md:p-5">
                <h2 className="text-2xl font-semibold">ToyyibPay Information</h2>
              </div>
              <div className="w-full stack-y-3 p-4 md:p-5">
                <div className="w-full">
                  <KeyField
                    {...register("secretKey")}
                    id="secretKey"
                    name="secretKey"
                    containerClassName="w-full"
                    label="User Secret Key"
                    autoComplete="off"
                    autoCorrect="off"
                    defaultValue={existingEnvKeys?.secretKey || ""}
                  />
                  {errors.secretKey && (
                    <p className="py-2 text-xs text-red-500">{errors.secretKey.message}</p>
                  )}
                </div>
                <div className="w-full">
                  <KeyField
                    {...register("categoryCode")}
                    id="categoryCode"
                    name="categoryCode"
                    containerClassName="w-full"
                    label="Category Code"
                    autoComplete="off"
                    autoCorrect="off"
                    defaultValue={existingEnvKeys?.categoryCode || ""}
                  />
                  {errors.categoryCode && (
                    <p className="py-2 text-xs text-red-500">{errors.categoryCode.message}</p>
                  )}
                </div>
                <div className="w-full">
                  <label className="text-default mb-1 block text-sm font-medium" htmlFor="paymentChannel">
                    Payment channel
                  </label>
                  <Select
                    inputId="paymentChannel"
                    options={paymentChannelOptions.map((option) => ({ ...option }))}
                    value={paymentChannelOptions
                      .map((option) => ({ ...option }))
                      .find((option) => option.value === selectedChannel)}
                    onChange={(option) => {
                      if (option) {
                        setValue("paymentChannel", option.value as SettingsSchema["paymentChannel"], {
                          shouldDirty: true,
                        });
                      }
                    }}
                  />
                </div>
                <div className="flex flex-col gap-3">
                  <CheckboxField
                    label="Use ToyyibPay sandbox (dev.toyyibpay.com)"
                    {...register("isSandbox")}
                    defaultChecked={props.isSandbox ?? false}
                  />
                  <CheckboxField
                    label="Enable DuitNow QR (must be activated on your ToyyibPay account)"
                    {...register("enableDuitNowQR")}
                    defaultChecked={props.enableDuitNowQR ?? false}
                  />
                </div>
                <p className="text-subtle text-sm">
                  Callback URL: <span className="text-emphasis break-all">{webhookUrl}</span>
                  <br />
                  ToyyibPay posts the payment status to this URL. Your Cal.diy instance must be reachable from
                  the internet for bookings to be confirmed automatically.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-4">
              {isNewCredential ? (
                <>
                  <Button color="secondary" className="h-10" type="button" onClick={onCancel}>
                    {t("cancel")}
                  </Button>
                  <Button className="h-10" color="primary" type="submit" disabled={loading}>
                    {loading ? (
                      <>
                        <LoaderIcon className="mr-2 animate-spin" />
                        {t("connecting")}
                      </>
                    ) : (
                      t("connect")
                    )}
                  </Button>
                </>
              ) : (
                <>
                  <Link href="/apps/toyyibpay" className="inline-block">
                    <Button color="secondary" type="button">
                      Go to App Store
                    </Button>
                  </Link>
                  <Button className="h-10" color="primary" type="submit" disabled={loading}>
                    {t("save")}
                  </Button>
                </>
              )}
            </div>
          </form>
        </div>
      ) : (
        <AppNotInstalledMessage appName="toyyibpay" />
      )}
      <Toaster position="bottom-right" />
    </div>
  );
}
