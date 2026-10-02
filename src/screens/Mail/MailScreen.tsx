/**
 * Mail tab placeholder — replaced by the full email-client build
 * (src/screens/Mail/MailScreen.tsx) from the feedback-round worker.
 * This keeps the branch compiling until that lands.
 */
import { EmptyState } from '@dsect/ui/components/feedback';
import { Card } from '@dsect/ui/components/surfaces';

export function MailScreen() {
  return (
    <div className="flex flex-col gap-4 p-4">
      <Card className="p-3">
        <EmptyState
          mark="✉"
          title="Mail is being rebuilt"
          text="The DSECT email client (name@dsect.net) is landing in this feedback round."
        />
      </Card>
    </div>
  );
}
