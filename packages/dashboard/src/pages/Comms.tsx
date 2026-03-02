import { useState } from 'react';
import { PageTabs } from '../components/ui';
import Chat from './Chat';
import GroupChat from './GroupChat';
import Meetings from './Meetings';

type Tab = 'chat' | 'group-chat' | 'meetings';

export default function Comms() {
  const [tab, setTab] = useState<Tab>('chat');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-txt-primary">Comms</h1>
        <p className="mt-1 text-sm text-txt-muted">
          Agent chat and meeting records
        </p>
      </div>
      <PageTabs
        tabs={[
          { key: 'chat' as Tab, label: 'Chat' },
          { key: 'group-chat' as Tab, label: 'Group Chat' },
          { key: 'meetings' as Tab, label: 'Meetings' },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'group-chat' ? <GroupChat /> : tab === 'meetings' ? <Meetings /> : <Chat />}
    </div>
  );
}
