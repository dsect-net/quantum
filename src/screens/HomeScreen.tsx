import { ComingSoon } from '../components/ComingSoon';
import { DemoBanner } from '../components/DemoBanner';
import { getSettings } from '../lib/settings';

export function HomeScreen() {
  const settings = getSettings();
  return (
    <div className="flex flex-col gap-4 p-4">
      <DemoBanner configured={!!settings.hub.baseUrl} serviceLabel="Hub API" />
      <ComingSoon
        module="Home dashboard"
        source="hub-api dashboard endpoints (services, agents, docket, logs, metrics)"
      />
    </div>
  );
}
