import { Zap } from 'lucide-react';

interface CostChipProps {
  cost?: number | null;
  duration?: number | null;
  model?: string;
}

export function CostChip({ cost, duration, model = 'Claude' }: CostChipProps) {
  if (cost === undefined && duration === undefined && !model) {
    return null;
  }

  const costDisplay = cost == null || cost === 0 ? null : `$${cost.toFixed(4)}`;

  return (
    <div className="flex items-center gap-1.5 rounded-full bg-gradient-to-r from-green-500 to-green-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm">
      <Zap className="h-3 w-3 flex-shrink-0" />
      <span className="flex items-center gap-1">
        {costDisplay && <span>{costDisplay}</span>}
        {costDisplay && model && <span>·</span>}
        {model && <span>{model}</span>}
        {(costDisplay || model) && duration && <span>·</span>}
        {duration && <span>{duration}ms</span>}
      </span>
    </div>
  );
}
