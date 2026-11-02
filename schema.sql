-- Run once in the Supabase SQL editor. No browser database access.
create table public.orders (
 id uuid primary key, request_hash text not null, created_at timestamptz not null default now()
);
create table public.tickets (
 id text primary key, order_id uuid not null references public.orders(id),
 student_number text not null default '', attendee_name text not null,
 email text not null, ticket_option text not null,
 price_cents integer not null check(price_cents in (30000,35000,40000)),
 payment_status text not null default 'Confirmed' check(payment_status='Confirmed'),
 status text not null default 'Issued' check(status in ('Issued','Checked In')),
 issued_at timestamptz not null default now(), checked_in_at timestamptz,
 scanned_by text, email_status text not null default 'Pending' check(email_status in ('Pending','Sent','Failed')),
 check ((status='Issued' and checked_in_at is null and scanned_by is null) or
 (status='Checked In' and checked_in_at is not null and scanned_by is not null))
);
create index tickets_order_idx on public.tickets(order_id);
create table public.mail_jobs(ticket_id text primary key references public.tickets(id), claimed_at timestamptz not null);
alter table public.orders enable row level security;
alter table public.tickets enable row level security;
alter table public.mail_jobs enable row level security;
revoke all on public.orders, public.tickets, public.mail_jobs from anon, authenticated;

create function public.issue_order(p_id uuid,p_hash text,p_tickets jsonb)
returns setof public.tickets language plpgsql security definer set search_path='' as $$
declare existing_hash text;
begin
 insert into public.orders(id,request_hash) values(p_id,p_hash) on conflict do nothing;
 select request_hash into existing_hash from public.orders where id=p_id for update;
 if existing_hash<>p_hash then raise exception 'Idempotency key reused with different request'; end if;
 if not exists(select 1 from public.tickets where order_id=p_id) then
 insert into public.tickets(id,order_id,student_number,attendee_name,email,ticket_option,price_cents)
 select x.id,p_id,x.student_number,x.attendee_name,x.email,x.ticket_option,x.price_cents
 from jsonb_to_recordset(p_tickets) as x(id text,student_number text,attendee_name text,email text,ticket_option text,price_cents integer);
 end if;
 return query select * from public.tickets where order_id=p_id order by id;
end $$;

create function public.redeem_ticket(p_id text,p_admin text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.tickets;
begin
 select * into t from public.tickets where id=p_id for update;
 if not found then return jsonb_build_object('result','invalid'); end if;
 if t.status='Checked In' then return jsonb_build_object('result','duplicate','ticket',to_jsonb(t)); end if;
 update public.tickets set status='Checked In',checked_in_at=now(),scanned_by=p_admin where id=p_id returning * into t;
 return jsonb_build_object('result','valid','ticket',to_jsonb(t));
end $$;

-- A persisted lease avoids concurrent email retries; SMTP acceptance is not exactly-once.
create function public.claim_mail(p_id text)
returns boolean language plpgsql security definer set search_path='' as $$
declare claimed text;
begin
 if not exists(select 1 from public.tickets where id=p_id and email_status<>'Sent') then return false; end if;
 insert into public.mail_jobs(ticket_id,claimed_at) values(p_id,now())
 on conflict(ticket_id) do update set claimed_at=now() where public.mail_jobs.claimed_at<now()-interval '5 minutes'
 returning ticket_id into claimed;
 return claimed is not null;
end $$;
revoke all on function public.issue_order(uuid,text,jsonb),public.redeem_ticket(text,text),public.claim_mail(text) from public,anon,authenticated;
grant execute on function public.issue_order(uuid,text,jsonb),public.redeem_ticket(text,text),public.claim_mail(text) to service_role;

-- Explicit privileges for the server role; client roles remain denied.
grant select,insert,update,delete on public.orders,public.tickets,public.mail_jobs to service_role;
