import { ComingSoon } from '../components/ComingSoon';
import { DemoBanner } from '../components/DemoBanner';
import { getSettings } from '../lib/settings';

export function CreateScreen() {
  const settings = getSettings();
  return (
    <div className="flex flex-col gap-4 p-4">
      <DemoBanner configured={!!settings.nebula.baseUrl} serviceLabel="Nebula" />
      <ComingSoon
        module="Create"
        source="the Nebula API (run-forms, job queue, gallery)"
      />
    </div>
  );
}
