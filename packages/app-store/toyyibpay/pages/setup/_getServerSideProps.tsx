import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { CredentialRepository } from "@calcom/features/credentials/repositories/CredentialRepository";
import type { GetServerSidePropsContext } from "next";
import type { z } from "zod";
import { toyyibpayCredentialKeysSchema } from "../../lib/toyyibpayCredentialKeysSchema";

export type IToyyibpaySetupProps = Partial<z.infer<typeof toyyibpayCredentialKeysSchema>>;

export const getServerSideProps = async (ctx: GetServerSidePropsContext) => {
  try {
    const notFound = { notFound: true } as const;
    if (typeof ctx.params?.slug !== "string") return notFound;

    const { req } = ctx;
    const session = await getServerSession({ req });
    if (!session?.user?.id) return { redirect: { permanent: false, destination: "/auth/login" } };

    const credential = await CredentialRepository.findFirstByUserIdAndType({
      userId: session.user.id,
      type: "toyyibpay_payment",
    });

    if (credential?.key) {
      const keyParsing = toyyibpayCredentialKeysSchema.safeParse(credential.key);
      if (keyParsing.success) {
        return { props: keyParsing.data };
      }
    }

    return { props: {} as IToyyibpaySetupProps };
  } catch {
    return { props: {} as IToyyibpaySetupProps };
  }
};
