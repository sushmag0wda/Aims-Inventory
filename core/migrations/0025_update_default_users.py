from django.db import migrations
from django.contrib.auth.hashers import make_password


ADMIN_USERNAME = 'admin'
USER_USERNAME = 'user'
ADMIN_PASSWORD = 'Admin@123'
USER_PASSWORD = 'User@123'


def ensure_default_accounts(apps, schema_editor):
    User = apps.get_model('core', 'User')

    admin_defaults = {
        'email': 'admin@example.com',
        'first_name': 'Default',
        'last_name': 'Admin',
    }
    admin, _ = User.objects.get_or_create(username=ADMIN_USERNAME, defaults=admin_defaults)

    admin.email = admin.email or admin_defaults['email']
    admin.first_name = admin.first_name or admin_defaults['first_name']
    admin.last_name = admin.last_name or admin_defaults['last_name']
    admin.role = 'admin'
    admin.approval_status = 'approved'
    admin.is_staff = True
    admin.is_superuser = True
    admin.is_active = True
    admin.password = make_password(ADMIN_PASSWORD)
    admin.save()

    user_defaults = {
        'email': 'user@example.com',
        'first_name': 'Demo',
        'last_name': 'User',
    }
    demo_user, _ = User.objects.get_or_create(username=USER_USERNAME, defaults=user_defaults)

    demo_user.email = demo_user.email or user_defaults['email']
    demo_user.first_name = demo_user.first_name or user_defaults['first_name']
    demo_user.last_name = demo_user.last_name or user_defaults['last_name']
    demo_user.role = 'stationery'
    demo_user.approval_status = 'approved'
    demo_user.is_staff = False
    demo_user.is_superuser = False
    demo_user.is_active = True
    demo_user.password = make_password(USER_PASSWORD)
    demo_user.save()


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ('core', '0024_alter_user_managers'),
    ]

    operations = [
        migrations.RunPython(ensure_default_accounts, noop),
    ]
