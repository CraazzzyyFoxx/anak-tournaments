export type RealtimeConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting";

export type RealtimeEventEnvelope<TData = Record<string, unknown>> = {
  event_id: number;
  event_type: string;
  schema_version: number;
  occurred_at: string;
  actor_user_id: number | null;
  data: TData;
};

type SubscribeOp = {
  op: "subscribe";
  topic: string;
  after_event_id?: number;
};

type UnsubscribeOp = {
  op: "unsubscribe";
  topic: string;
};

type PingOp = {
  op: "ping";
};

/** Client-originated ephemeral broadcast to a subscribed topic (e.g. live drag). */
type PublishOp = {
  op: "publish";
  topic: string;
  event_type: string;
  data: Record<string, unknown>;
};

export type ClientRealtimeFrame = SubscribeOp | UnsubscribeOp | PingOp | PublishOp;

type SubscribedFrame = {
  op: "subscribed";
  topic: string;
  cursor: number;
};

type ErrorFrame = {
  op: "error";
  topic?: string | null;
  code: string;
  message: string;
};

export type EventFrame<TData = Record<string, unknown>> = {
  op: "event";
  topic: string;
  event: RealtimeEventEnvelope<TData>;
};

type PongFrame = {
  op: "pong";
};

export type ServerRealtimeFrame<TData = Record<string, unknown>> =
  | SubscribedFrame
  | ErrorFrame
  | EventFrame<TData>
  | PongFrame;
