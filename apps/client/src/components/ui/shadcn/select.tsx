import * as React from 'react';
import { Select as SelectPrimitive } from 'radix-ui';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';

const Select = SelectPrimitive.Root;
const SelectValue = SelectPrimitive.Value;

function SelectTrigger({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return <SelectPrimitive.Trigger data-slot="select-trigger" className={cn('flex h-8 w-full min-w-0 max-w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 [&>span]:min-w-0 [&>span]:truncate [&_svg]:shrink-0', className)} {...props}>
    {children}<SelectPrimitive.Icon asChild><ChevronDown className="size-3.5 opacity-50" /></SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>;
}

function SelectContent({ className, children, position = 'popper', container, ...props }: React.ComponentProps<typeof SelectPrimitive.Content> & { container?: React.ComponentProps<typeof SelectPrimitive.Portal>['container'] }) {
  return <SelectPrimitive.Portal container={container}>
    <SelectPrimitive.Content data-slot="select-content" position={position} sideOffset={4} className={cn('relative z-50 max-h-(--radix-select-content-available-height) min-w-(--radix-select-trigger-width) overflow-auto rounded-md border border-border bg-popover text-popover-foreground shadow-md', className)} {...props}>
      <SelectPrimitive.ScrollUpButton className="flex justify-center py-1"><ChevronUp className="size-3.5" /></SelectPrimitive.ScrollUpButton>
      <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
      <SelectPrimitive.ScrollDownButton className="flex justify-center py-1"><ChevronDown className="size-3.5" /></SelectPrimitive.ScrollDownButton>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>;
}

function SelectItem({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return <SelectPrimitive.Item data-slot="select-item" className={cn('relative flex cursor-default select-none items-center rounded py-1.5 pr-7 pl-2 text-xs outline-none focus:bg-accent focus:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50', className)} {...props}>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    <span className="absolute right-2 flex items-center"><SelectPrimitive.ItemIndicator><Check className="size-3.5" /></SelectPrimitive.ItemIndicator></span>
  </SelectPrimitive.Item>;
}

export { Select, SelectValue, SelectTrigger, SelectContent, SelectItem };
