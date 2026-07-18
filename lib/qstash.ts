import { Client } from "@upstash/qstash";

let client: Client | null = null;

function qstash(): Client {
  if (!client) {
    client = new Client({ token: process.env.QSTASH_TOKEN! });
  }
  return client;
}

// ジョブチェーン用: 次のステップのAPI RouteをQStash経由で呼び出す。
// deduplicationId で同一月の二重投入を防ぐ。
export async function enqueueJob(
  path: string,
  body: Record<string, unknown>,
  deduplicationId?: string
) {
  await qstash().publishJSON({
    url: `${process.env.APP_URL}${path}`,
    body,
    retries: 3,
    ...(deduplicationId ? { deduplicationId } : {}),
  });
}
