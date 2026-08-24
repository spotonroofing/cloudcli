import { Loader } from '../../../shared/view/beui/Loader';

export default function PrdEditorLoadingState() {
  return (
    <div className="fixed inset-0 z-[200] md:flex md:items-center md:justify-center md:bg-black/50">
      <div className="flex h-full w-full items-center justify-center bg-card p-8 md:h-auto md:w-auto md:rounded-lg">
        <div className="flex items-center gap-3">
          <Loader variant="dot-matrix" size={24} className="text-primary" />
          <span className="text-foreground">Loading PRD...</span>
        </div>
      </div>
    </div>
  );
}
