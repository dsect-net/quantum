import { ComingSoon } from '../components/ComingSoon';

export function ChatScreen() {
  return (
    <div className="flex flex-col gap-4 p-4">
      <ComingSoon
        module="Chat"
        source="the Sol gateway (/api/sol/v1) plus the Agents tab"
      />
    </div>
  );
}
