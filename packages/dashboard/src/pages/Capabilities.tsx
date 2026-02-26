import { useState } from 'react';
import { PageTabs } from '../components/ui';
import Skills from './Skills';
import WorldModel from './WorldModel';

type Tab = 'skills' | 'models';

export default function Capabilities() {
  const [tab, setTab] = useState<Tab>('skills');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-txt-primary">Capabilities</h1>
        <p className="mt-1 text-sm text-txt-muted">
          Agent skill library and self-awareness models
        </p>
      </div>
      <PageTabs
        tabs={[
          { key: 'skills' as Tab, label: 'Skill Library' },
          { key: 'models' as Tab, label: 'Self-Models' },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'models' ? <WorldModel /> : <Skills />}
    </div>
  );
}
