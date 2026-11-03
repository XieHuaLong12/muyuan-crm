import { BOSShell } from '@/components/bos/BOSShell';
import { CountryCard } from '@/components/bos-v2/CountryCard';
import { adminWorkspacePage } from '@/services/workspace-page';
import { countryCard } from '@/services/country-card-service';

export const dynamic = 'force-dynamic';

/** 国家作战卡: one country by 进线时间 — when good leads come, when to send, how fast, how often, which ads, what buyers want. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { user, boot } = await adminWorkspacePage();
  const data = await countryCard(user, await searchParams);
  return <BOSShell boot={boot}><CountryCard data={data} /></BOSShell>;
}
