import { ComingSoon } from '../components/ComingSoon';
import { DemoBanner } from '../components/DemoBanner';
import { getSettings } from '../lib/settings';

export function MessagesScreen() {
  const settings = getSettings();
  return (
    <div className="flex flex-col gap-4 p-4">
      <DemoBanner configured={!!settings.relay.baseUrl} serviceLabel="relay" />
      <ComingSoon
        module="Messages"
        source="the Hermes relay (messages, mentions) and the herald digest"
      />
    </div>
  );
}
