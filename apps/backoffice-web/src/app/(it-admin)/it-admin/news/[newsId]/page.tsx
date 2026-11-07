import { ItPlatformNewsDetail } from "@/components/it-admin/platform-news-console";

export default async function ItNewsDetailPage({ params }: { params: Promise<{ newsId: string }> }) {
  const { newsId } = await params;
  return <ItPlatformNewsDetail id={newsId} />;
}
