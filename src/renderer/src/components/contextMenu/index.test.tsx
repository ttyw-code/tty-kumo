import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ContextMenu, { type MenuItemConfig } from './index';

function renderMenu(items: MenuItemConfig[]) {
  const onClose = vi.fn();
  const result = render(
    <ContextMenu
      position={{ x: 100, y: 200 }}
      onClose={onClose}
      items={items}
    />,
  );
  return { onClose, ...result };
}

describe('ContextMenu', () => {
  it('渲染所有菜单项', () => {
    renderMenu([
      { icon: '🔗', label: '分享', onClick: () => {} },
      { icon: '✏️', label: '重命名', onClick: () => {} },
    ]);

    expect(screen.getByText('分享')).toBeInTheDocument();
    expect(screen.getByText('重命名')).toBeInTheDocument();
  });

  it('点击遮罩关闭菜单', async () => {
    const { onClose } = renderMenu([
      { icon: '🔗', label: '分享', onClick: () => {} },
    ]);

    await userEvent.click(screen.getByTestId('context-menu-backdrop'));
    expect(onClose).toHaveBeenCalled();
  });

  it('点击菜单项执行对应操作并关闭菜单', async () => {
    const onShare = vi.fn();
    const { onClose } = renderMenu([
      { icon: '🔗', label: '分享', onClick: onShare },
    ]);

    await userEvent.click(screen.getByText('分享'));
    expect(onShare).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
