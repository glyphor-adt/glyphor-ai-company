import {
  MdBolt,
  MdCode,
  MdExplore,
  MdBarChart,
  MdCampaign,
  MdSupportAgent,
  MdTrackChanges,
  MdSmartToy,
  MdPalette,
  MdMonitorHeart,
} from 'react-icons/md';
import type { IconType } from 'react-icons';

const ICON_MAP: Record<string, IconType> = {
  MdBolt,
  MdCode,
  MdExplore,
  MdBarChart,
  MdCampaign,
  MdSupportAgent,
  MdTrackChanges,
  MdSmartToy,
  MdPalette,
  MdMonitorHeart,
};

export function AgentIcon({
  name,
  size = 16,
  color,
}: {
  name: string;
  size?: number;
  color?: string;
}) {
  const Icon = ICON_MAP[name] ?? MdSmartToy;
  return <Icon size={size} color={color} />;
}
