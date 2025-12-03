import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import ChatLayout from "@/components/chat-component/chat-layout";
import { Navbar } from "@/components/navbar";
import { Toaster } from "@/components/ui/sonner";

// Updated for Next.js 15: params is now a Promise in type definition.
export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <SidebarProvider>
      <div className="grid h-screen w-full md:grid-cols-[220px_1fr] lg:grid-cols-[220px_1fr]">
        <div className="hidden border-r bg-muted/40 md:block">
          <AppSidebar />
        </div>
        <div className="flex flex-col bg-background">
          <Navbar>
            <div className="flex items-center gap-4">
              <h1 className="text-xl font-semibold">Career Guidance Assistant</h1>
            </div>
          </Navbar>
          <main className="flex-1 overflow-y-auto p-4 lg:p-6">
            <ChatLayout conversationIdProp={id} />
          </main>
        </div>
      </div>
      <Toaster />
    </SidebarProvider>
  );
}
