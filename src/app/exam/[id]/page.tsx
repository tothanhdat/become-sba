import { ExamClient } from "@/components/exam/ExamClient";

export default async function ExamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ExamClient sessionId={Number(id)} />;
}
