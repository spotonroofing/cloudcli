import { memo } from 'react';
import type { LucideIcon } from 'lucide-react';

import { BeuiSwitch } from '../../../shared/view/beui';
import { TOGGLE_ROW_CLASS } from '../constants';

type QuickSettingsToggleRowProps = {
  label: string;
  icon: LucideIcon;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
};

function QuickSettingsToggleRow({
  label,
  icon: Icon,
  checked,
  onCheckedChange,
}: QuickSettingsToggleRowProps) {
  return (
    <div className={TOGGLE_ROW_CLASS} onClick={() => onCheckedChange(!checked)}>
      <span className="flex items-center gap-2 text-sm text-foreground">
        <Icon className="h-4 w-4 text-muted-foreground" />
        {label}
      </span>
      {/* The row itself toggles too; stop the switch's own click from
          bubbling into a second (reverting) toggle. */}
      <span onClick={(event) => event.stopPropagation()}>
        <BeuiSwitch checked={checked} onCheckedChange={onCheckedChange} ariaLabel={label} />
      </span>
    </div>
  );
}

export default memo(QuickSettingsToggleRow);
