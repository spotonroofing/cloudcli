import { BeuiSwitch } from '../../../shared/view/beui/BeuiSwitch';

type SettingsToggleProps = {
  checked: boolean;
  onChange: (value: boolean) => void;
  ariaLabel: string;
  disabled?: boolean;
};

export default function SettingsToggle({ checked, onChange, ariaLabel, disabled }: SettingsToggleProps) {
  return (
    <BeuiSwitch
      checked={checked}
      onCheckedChange={onChange}
      ariaLabel={ariaLabel}
      disabled={disabled}
    />
  );
}
