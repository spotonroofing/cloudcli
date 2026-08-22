import { Moon, Sun } from 'lucide-react';

import { useTheme } from '../../../contexts/ThemeContext';
import { BeuiSwitch } from '../beui/BeuiSwitch';

type DarkModeToggleProps = {
  checked?: boolean;
  onToggle?: (nextValue: boolean) => void;
  ariaLabel?: string;
};

function DarkModeToggle({
  checked,
  onToggle,
  ariaLabel = 'Toggle dark mode',
}: DarkModeToggleProps) {
  const { isDarkMode, toggleDarkMode } = useTheme();
  const isControlled = typeof checked === 'boolean' && typeof onToggle === 'function';
  const isEnabled = isControlled ? checked : isDarkMode;

  const handleToggle = () => {
    if (isControlled && onToggle) {
      onToggle(!isEnabled);
      return;
    }

    toggleDarkMode();
  };

  return (
    <BeuiSwitch
      checked={isEnabled}
      onCheckedChange={handleToggle}
      ariaLabel={ariaLabel}
      thumbContent={
        isEnabled ? (
          <Moon className="h-3 w-3 text-primary" />
        ) : (
          <Sun className="h-3 w-3 text-muted-foreground" />
        )
      }
    />
  );
}

export default DarkModeToggle;
