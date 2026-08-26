-- Kit identity documents reused across applications (CNIC, B-form).

alter type public.document_type add value if not exists 'identity_document';
alter type public.document_type add value if not exists 'family_document';
