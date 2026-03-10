import { useState } from 'react';
import { PageTabs } from '../components/ui';
import Chat from './Chat';
import GroupChat from './GroupChat';
import Meetings from './Meetings';

type Tab = 'chat' | 'group-chat' | 'meetings';

export default function Comms() {
  const [tab, setTab] = useState<Tab>('chat');

  return (
    <div className="flex flex-col h-[calc(100dvh-10rem-env(safe-area-inset-top,0px))] md:h-[calc(100vh-6rem)]">
      <div className="hidden md:block flex-shrink-0">
        <h1 className="text-xl md:text-2xl font-bold text-txt-primary">Comms</h1>
        <p className="mt-1 text-xs md:text-sm text-txt-muted">
          Agent chat and meeting records
        </p>
      </div>
      <div className="flex-shrink-0 md:mt-6">
        <PageTabs
          tabs={[
            { key: 'chat' as Tab, label: 'Chat' },
            { key: 'group-chat' as Tab, label: 'Group Chat' },
            { key: 'meetings' as Tab, label: 'Meetings' },
          ]}
          active={tab}
          onChange={setTab}
        />
      </div>
      <div className="flex-1 min-h-0 mt-3">
        {tab === 'group-chat' ? <GroupChat embedded /> : tab === 'meetings' ? <Meetings /> : <Chat embedded />}
      </div>
    </div>
  );
}
