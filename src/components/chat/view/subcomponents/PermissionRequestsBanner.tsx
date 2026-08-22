import React from 'react';

import type { PendingPermissionRequest } from '../../types/types';
import { buildClaudeToolPermissionEntry, formatToolInputForDisplay } from '../../utils/chatPermissions';
import { getClaudeSettings } from '../../utils/chatStorage';
import { getPermissionPanel, registerPermissionPanel } from '../../tools/configs/permissionPanelRegistry';
import { AskUserQuestionPanel } from '../../tools/components/InteractiveRenderers';
import { ToolApproval } from '../../../../shared/view/beui/ToolApproval';

registerPermissionPanel('AskUserQuestion', AskUserQuestionPanel);

interface PermissionRequestsBannerProps {
  pendingPermissionRequests: PendingPermissionRequest[];
  handlePermissionDecision: (
    requestIds: string | string[],
    decision: { allow?: boolean; message?: string; rememberEntry?: string | null; updatedInput?: unknown },
  ) => void;
  handleGrantToolPermission: (suggestion: { entry: string; toolName: string }) => { success: boolean };
}

export default function PermissionRequestsBanner({
  pendingPermissionRequests,
  handlePermissionDecision,
  handleGrantToolPermission,
}: PermissionRequestsBannerProps) {
  // Filter out plan tool requests — they are handled inline by PlanDisplay
  const filteredRequests = pendingPermissionRequests.filter(
    (r) => r.toolName !== 'ExitPlanMode' && r.toolName !== 'exit_plan_mode'
  );

  if (!filteredRequests.length) {
    return null;
  }

  return (
    <div className="mb-3 space-y-2">
      {filteredRequests.map((request) => {
        const CustomPanel = getPermissionPanel(request.toolName);
        if (CustomPanel) {
          return (
            <CustomPanel
              key={request.requestId}
              request={request}
              onDecision={handlePermissionDecision}
            />
          );
        }

        const rawInput = formatToolInputForDisplay(request.input);
        const permissionEntry = buildClaudeToolPermissionEntry(request.toolName, rawInput);
        const settings = getClaudeSettings();
        const alreadyAllowed = permissionEntry ? settings.allowedTools.includes(permissionEntry) : false;
        const rememberLabel = alreadyAllowed ? 'Allow (saved)' : 'Allow & remember';
        const matchingRequestIds = permissionEntry
          ? pendingPermissionRequests
              .filter(
                (item) =>
                  buildClaudeToolPermissionEntry(item.toolName, formatToolInputForDisplay(item.input)) === permissionEntry,
              )
              .map((item) => item.requestId)
          : [request.requestId];

        return (
          <ToolApproval
            key={request.requestId}
            status="pending"
            tool={request.toolName}
            description={
              permissionEntry ? (
                <span className="text-xs">
                  Allow rule:{' '}
                  <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-xs">{permissionEntry}</code>
                </span>
              ) : undefined
            }
            code={rawInput || undefined}
            detailsLabel="View tool input"
            onApprove={() => handlePermissionDecision(request.requestId, { allow: true })}
            onAlwaysAllow={() => {
              if (permissionEntry && !alreadyAllowed) {
                handleGrantToolPermission({ entry: permissionEntry, toolName: request.toolName });
              }
              handlePermissionDecision(matchingRequestIds, { allow: true, rememberEntry: permissionEntry });
            }}
            alwaysAllowLabel={rememberLabel}
            alwaysAllowDisabled={!permissionEntry}
            onDeny={() => handlePermissionDecision(request.requestId, { allow: false, message: 'User denied tool use' })}
          />
        );
      })}
    </div>
  );
}
