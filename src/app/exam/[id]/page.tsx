import { redirect } from "next/navigation";

import { ExamClient } from "@/components/exam/ExamClient";
import { auth } from "@/lib/auth";

export default async function ExamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/api/auth/signin?callbackUrl=${encodeURIComponent(`/exam/${id}`)}`);
  }
  return <ExamClient sessionId={Number(id)} />;
}
