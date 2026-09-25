insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('subscription-payment-evidence','subscription-payment-evidence',false,5242880,
array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do nothing;
