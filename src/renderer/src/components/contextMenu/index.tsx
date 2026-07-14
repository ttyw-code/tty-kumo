import React from 'react';
import { createPortal } from 'react-dom';

export interface MenuItemConfig {
  icon: React.ReactNode;
  label: string;
  danger?: boolean;
  onClick: () => void;
}

interface ContextMenuProps {
  items: MenuItemConfig[];
  position: { x: number; y: number };
  onClose: () => void;
}

const ContextMenu: React.FC<ContextMenuProps> = ({
  items,
  position,
  onClose,
}) => {
  return createPortal(
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        onMouseDown={onClose}
      />
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{ left: position.x, top: position.y }}
        className="fixed z-50 w-36 py-1 rounded-lg border border-border bg-overlay shadow-lg"
      >
        {items.map((item, index) => (
          <MenuItem key={index} {...item} onClose={onClose} />
        ))}
      </div>
    </>,
    document.body,
  );
};

function MenuItem({
  icon,
  label,
  danger,
  onClick,
  onClose,
}: MenuItemConfig & { onClose: () => void }) {
  return (
    <button
      onClick={() => {
        onClick();
        onClose();
      }}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors hover:bg-default-soft hover:cursor-pointer ${danger ? 'text-danger' : ''}`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

export default ContextMenu;
