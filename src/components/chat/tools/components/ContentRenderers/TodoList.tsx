import { memo, useMemo } from 'react';

import {
  TodoList as BeuiTodoList,
  type TodoListItemStatus,
} from '../../../../../shared/view/beui/TodoList';

export type TodoItem = {
  id?: string;
  content: string;
  status: string;
  priority?: string;
  activeForm?: string;
};

const normalizeStatus = (status: string): TodoListItemStatus => {
  if (status === 'completed') return 'completed';
  if (status === 'in_progress') return 'in-progress';
  return 'pending';
};

const TodoList = memo(
  ({
    todos,
    isResult = false,
  }: {
    todos: TodoItem[];
    isResult?: boolean;
  }) => {
    const normalized = useMemo(
      () =>
        todos.map((todo, index) => ({
          id: todo.id ?? `${todo.content}-${index}`,
          title: todo.content,
          status: normalizeStatus(todo.status),
        })),
      [todos],
    );

    if (normalized.length === 0) return null;

    return (
      <div>
        {isResult && (
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">
            Todo List ({normalized.length} {normalized.length === 1 ? 'item' : 'items'})
          </div>
        )}
        <BeuiTodoList items={normalized} />
      </div>
    );
  },
);

TodoList.displayName = 'TodoList';

export default TodoList;
