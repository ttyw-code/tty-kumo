import { Button, Separator } from '@heroui/react';
import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { Pin } from 'lucide-react';

interface Props {
  title?: React.ReactNode;
  header?: React.ReactNode;
  children?: React.ReactNode;
  contentClassName?: string;
}
let saveOnTop = false;

const BasePage = forwardRef<HTMLDivElement, Props>((props, ref) => {
  const [overlayWidth] = React.useState(0);
  const [onTop] = useState(saveOnTop);
  const contentRef = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => {
    return contentRef.current as HTMLDivElement;
  });

  return (
    <div ref={contentRef} className="w-full h-full flex flex-col">
      <div className="sticky top-0 z-40 h-12.25 w-full bg-background flex-none">
        <div className="app-drag p-2 flex justify-between h-12">
          <div className="title h-full text-lg leading-8">{props.title}</div>
          <div
            style={{ marginRight: overlayWidth }}
            className="header flex gap-1 h-full"
          >
            <Button
              size="sm"
              className="app-nodrag"
              isIconOnly
              variant={onTop ? 'tertiary' : 'ghost'}
              onPress={async () => {
                console.log('click pin');
              }}
            >
              <Pin size={16} />
            </Button>
          </div>
        </div>

        <Separator />
      </div>
      <div className="content flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        {props.children}
      </div>
    </div>
  );
});

BasePage.displayName = 'BasePage';
export default BasePage;
