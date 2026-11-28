-- T13: shop onboarding. Remember which rich menu was set up for a shop's channel.
alter table line_channels add column if not exists rich_menu_id text;
