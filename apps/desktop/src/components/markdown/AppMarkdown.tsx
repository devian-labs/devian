import { MessageResponse, type MessageResponseProps } from "@/components/ai-elements/message";

type AppMarkdownProps = {
    content: string;
    className?: string;
    components?: MessageResponseProps["components"];
};

export function AppMarkdown({ content, className, components }: AppMarkdownProps) {
    return (
        <MessageResponse className={className} components={components}>
            {content}
        </MessageResponse>
    );
}
