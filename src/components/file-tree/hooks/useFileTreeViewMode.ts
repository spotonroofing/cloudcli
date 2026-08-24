import { useCallback, useEffect, useState } from 'react';

import { onSettingChange, writeSetting } from '../../../utils/cloudSettings';
import {
  FILE_TREE_DEFAULT_VIEW_MODE,
  FILE_TREE_VIEW_MODES,
  FILE_TREE_VIEW_MODE_STORAGE_KEY,
} from '../constants/constants';
import type { FileTreeViewMode } from '../types/types';

type UseFileTreeViewModeResult = {
  viewMode: FileTreeViewMode;
  changeViewMode: (mode: FileTreeViewMode) => void;
};

export function useFileTreeViewMode(): UseFileTreeViewModeResult {
  const [viewMode, setViewMode] = useState<FileTreeViewMode>(FILE_TREE_DEFAULT_VIEW_MODE);

  useEffect(() => {
    try {
      const savedViewMode = localStorage.getItem(FILE_TREE_VIEW_MODE_STORAGE_KEY);
      if (savedViewMode && FILE_TREE_VIEW_MODES.includes(savedViewMode as FileTreeViewMode)) {
        setViewMode(savedViewMode as FileTreeViewMode);
      }
    } catch {
      // Keep default view mode when storage is unavailable.
    }
  }, []);

  // Another tab or device changed the view mode: apply it live.
  useEffect(() => onSettingChange([FILE_TREE_VIEW_MODE_STORAGE_KEY], (_key, value) => {
    if (value && FILE_TREE_VIEW_MODES.includes(value as FileTreeViewMode)) {
      setViewMode(value as FileTreeViewMode);
    }
  }), []);

  const changeViewMode = useCallback((mode: FileTreeViewMode) => {
    setViewMode(mode);

    try {
      writeSetting(FILE_TREE_VIEW_MODE_STORAGE_KEY, mode);
    } catch {
      // Keep runtime state even when persistence fails.
    }
  }, []);

  return {
    viewMode,
    changeViewMode,
  };
}

