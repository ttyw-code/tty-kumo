import React from 'react';
import { SquarePlus, ImagePlus, PackageSearch } from 'lucide-react';
import { Avatar, Button } from '@heroui/react';

interface SidebarProps {
  expanded: boolean;
}

const Sidebar: React.FC<SidebarProps> = ({ expanded }) => {
  return (
    <nav
      className={`h-full ${expanded ? 'w-50 border-r border-separator' : 'w-0'} overflow-hidden transition-all duration-300`}
    >
      <div className="flex flex-col gap-1 p-4 border-b border-separator whitespace-nowrap w-50">
        <div className="flex items-center gap-2 mb-6">
          <Avatar>
            <Avatar.Fallback className="bg-lime-400">B</Avatar.Fallback>
          </Avatar>
          <div className="flex flex-col gap-1">
            <span className="text-sm font-bold ">Bob</span>
            <span className="text-xs text-muted">bob@example.com</span>
          </div>
        </div>
        <Button className="w-full justify-start" variant="outline">
          <SquarePlus />
          New Chat
        </Button>
        <Button className="w-full justify-start" variant="outline">
          <ImagePlus />
          Library
        </Button>
        <Button className="w-full justify-start" variant="outline">
          <PackageSearch />
          Explore
        </Button>
      </div>
    </nav>
  );
};

export default Sidebar;
