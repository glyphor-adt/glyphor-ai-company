import Chat from './Chat';

export default function Comms() {
  return (
    <div className="flex flex-col h-[calc(100dvh-10rem-var(--sat))] md:h-[calc(100vh-6rem)]">
      <div className="hidden md:block flex-shrink-0">
        <h1 className="text-xl md:text-2xl font-bold text-txt-primary">Comms</h1>
        <p className="mt-1 text-xs md:text-sm text-txt-muted">
          Agent chat records
        </p>
      </div>
      <div className="flex-1 min-h-0 mt-3">
        <Chat embedded />
      </div>
    </div>
  );
}
