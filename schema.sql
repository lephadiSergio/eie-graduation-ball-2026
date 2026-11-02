begin;
-- Fresh production install. Apply once in the event's dedicated Supabase project.
create table public.orders (
 id uuid primary key, request_hash text not null, issued_by text not null,
 is_test boolean not null default false, created_at timestamptz not null default now()
);
create table public.tickets (
 id text primary key, order_id uuid not null references public.orders(id) on delete cascade,
 student_number text not null default '', attendee_name text not null, email text not null,
 ticket_option text not null check(ticket_option in ('EIE Single','EIE Double Special','Non-EIE Guest','Wits Staff')),
 price_cents integer not null,
 payment_status text not null default 'Confirmed' check(payment_status='Confirmed'),
 status text not null default 'Issued' check(status in ('Issued','Checked In','Cancelled')),
 issued_at timestamptz not null default now(), checked_in_at timestamptz, scanned_by text,
 cancelled_at timestamptz, cancelled_by text, cancellation_reason text,
 email_status text not null default 'Pending' check(email_status in ('Pending','Sending','Sent','Failed')),
 is_test boolean not null default false,
 check (price_cents=case ticket_option when 'EIE Double Special' then 30000 when 'Wits Staff' then 40000 else 35000 end),
 check ((status='Issued' and checked_in_at is null and cancelled_at is null) or
        (status='Checked In' and checked_in_at is not null and scanned_by is not null and cancelled_at is null) or
        (status='Cancelled' and checked_in_at is null and cancelled_at is not null and cancelled_by is not null))
);
create index tickets_order_idx on public.tickets(order_id);
create index tickets_roster_idx on public.tickets(issued_at desc,id);
create unique index tickets_student_unique on public.tickets(lower(student_number)) where student_number<>'' and status<>'Cancelled' and not is_test;
create unique index tickets_person_unique on public.tickets(lower(email),lower(attendee_name)) where status<>'Cancelled' and not is_test;
create table public.mail_jobs (
 ticket_id text primary key references public.tickets(id) on delete cascade,
 attempts integer not null default 0, next_attempt_at timestamptz not null default now(),
 locked_until timestamptz, lease_id uuid, last_error text
);
create index mail_jobs_due_idx on public.mail_jobs(next_attempt_at) where attempts<5;
create table public.staff_sessions (
 id uuid primary key, staff_id text not null, role text not null check(role in ('admin','scanner')),
 expires_at timestamptz not null, created_at timestamptz not null default now()
);
create index staff_sessions_expiry_idx on public.staff_sessions(expires_at);
alter table public.orders enable row level security;
alter table public.tickets enable row level security;
alter table public.mail_jobs enable row level security;
alter table public.staff_sessions enable row level security;
revoke all on public.orders,public.tickets,public.mail_jobs,public.staff_sessions from public,anon,authenticated;
grant select,insert,update,delete on public.orders,public.tickets,public.mail_jobs,public.staff_sessions to service_role;

create function public.issue_order(p_id uuid,p_hash text,p_tickets jsonb,p_admin text,p_is_test boolean default false)
returns setof public.tickets language plpgsql security definer set search_path='' as $$
declare previous public.orders;
begin
 if jsonb_array_length(p_tickets) not between 1 and 2 then raise exception 'Invalid headcount'; end if;
 insert into public.orders(id,request_hash,issued_by,is_test) values(p_id,p_hash,p_admin,p_is_test) on conflict do nothing;
 select * into previous from public.orders where id=p_id for update;
 if previous.request_hash<>p_hash or previous.is_test<>p_is_test then raise sqlstate 'PT409' using message='Request key already used with different details'; end if;
 if not exists(select 1 from public.tickets where order_id=p_id) then
  insert into public.tickets(id,order_id,student_number,attendee_name,email,ticket_option,price_cents,is_test)
  select x.id,p_id,x.student_number,x.attendee_name,x.email,x.ticket_option,x.price_cents,p_is_test
  from jsonb_to_recordset(p_tickets) as x(id text,student_number text,attendee_name text,email text,ticket_option text,price_cents integer);
  if not p_is_test then insert into public.mail_jobs(ticket_id) select id from public.tickets where order_id=p_id; end if;
 end if;
 return query select * from public.tickets where order_id=p_id order by id;
end $$;

create function public.redeem_ticket(p_id text,p_admin text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.tickets;
begin
 select * into t from public.tickets where id=p_id for update;
 if not found then return jsonb_build_object('result','invalid'); end if;
 if t.status='Cancelled' then return jsonb_build_object('result','cancelled','ticket',to_jsonb(t)); end if;
 if t.status='Checked In' then return jsonb_build_object('result','duplicate','ticket',to_jsonb(t)); end if;
 update public.tickets set status='Checked In',checked_in_at=now(),scanned_by=p_admin where id=p_id returning * into t;
 return jsonb_build_object('result','valid','ticket',to_jsonb(t));
end $$;

create function public.event_stats()
returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('total',count(*),'checked_in',count(*) filter(where status='Checked In'),
 'cancelled',count(*) filter(where status='Cancelled'),
 'sales_cents',coalesce(sum(price_cents) filter(where status<>'Cancelled'),0),
 'email_pending',count(*) filter(where status<>'Cancelled' and email_status in ('Pending','Sending')),
 'email_failed',count(*) filter(where status<>'Cancelled' and email_status='Failed'))
 from public.tickets where not is_test;
$$;

create function public.claim_mail_batch(p_limit integer default 2)
returns setof jsonb language plpgsql security definer set search_path='' as $$
declare j public.mail_jobs; t public.tickets;
begin
 for j in select m.* from public.mail_jobs m join public.tickets t on t.id=m.ticket_id
  where m.attempts<5 and m.next_attempt_at<=now() and (m.locked_until is null or m.locked_until<now())
  and t.status<>'Cancelled' and t.email_status<>'Sent' and not t.is_test
  order by m.next_attempt_at limit least(2,greatest(1,p_limit)) for update of m skip locked
 loop
  update public.mail_jobs set attempts=attempts+1,locked_until=now()+interval '3 minutes',lease_id=pg_catalog.gen_random_uuid()
  where ticket_id=j.ticket_id returning * into j;
  update public.tickets set email_status='Sending' where id=j.ticket_id returning * into t;
  return next jsonb_build_object('ticket',to_jsonb(t),'lease_id',j.lease_id,'attempts',j.attempts);
 end loop;
end $$;

create function public.finish_mail(p_id text,p_lease uuid,p_success boolean,p_error text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare j public.mail_jobs;
begin
 select * into j from public.mail_jobs where ticket_id=p_id and lease_id=p_lease for update;
 if not found then return false; end if;
 update public.tickets set email_status=case when p_success then 'Sent' when j.attempts>=5 then 'Failed' else 'Pending' end where id=p_id and status<>'Cancelled';
 if p_success then delete from public.mail_jobs where ticket_id=p_id;
 else update public.mail_jobs set locked_until=null,lease_id=null,last_error=left(p_error,120),next_attempt_at=now()+least(900,30*power(2,j.attempts-1))::integer*interval '1 second' where ticket_id=p_id;
 end if;
 return true;
end $$;

create function public.retry_mail(p_id text)
returns boolean language plpgsql security definer set search_path='' as $$
declare changed text;
begin
 perform 1 from public.tickets where id=p_id and status<>'Cancelled' and not is_test for update;
 if not found then return false; end if;
 insert into public.mail_jobs(ticket_id) values(p_id)
 on conflict(ticket_id) do update set attempts=0,next_attempt_at=now(),last_error=null,lease_id=null,locked_until=null
 where public.mail_jobs.locked_until is null or public.mail_jobs.locked_until<now() returning ticket_id into changed;
 if changed is null then return false; end if;
 update public.tickets set email_status='Pending' where id=p_id;
 return true;
end $$;

create function public.cancel_ticket(p_id text,p_admin text,p_reason text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 update public.tickets set status='Cancelled',cancelled_at=now(),cancelled_by=p_admin,cancellation_reason=left(p_reason,200)
 where id=p_id and status='Issued';
 if not found then return false; end if;
 delete from public.mail_jobs where ticket_id=p_id;
 return true;
end $$;

create function public.cleanup_probes(p_ids uuid[])
returns void language sql security definer set search_path='' as $$
 delete from public.orders where is_test and id=any(p_ids);
$$;
revoke all on function public.issue_order(uuid,text,jsonb,text,boolean),public.redeem_ticket(text,text),public.event_stats(),public.claim_mail_batch(integer),public.finish_mail(text,uuid,boolean,text),public.retry_mail(text),public.cancel_ticket(text,text,text),public.cleanup_probes(uuid[]) from public,anon,authenticated;
grant execute on function public.issue_order(uuid,text,jsonb,text,boolean),public.redeem_ticket(text,text),public.event_stats(),public.claim_mail_batch(integer),public.finish_mail(text,uuid,boolean,text),public.retry_mail(text),public.cancel_ticket(text,text,text),public.cleanup_probes(uuid[]) to service_role;

commit;
