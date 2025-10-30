from django.db import migrations


def create_default_users(apps, schema_editor):
    User = apps.get_model('core', 'User')

    admin_username = 'admin'
    demo_username = 'user'

    if not User.objects.filter(username=admin_username).exists():
        User.objects.create_superuser(
            username=admin_username,
            email='admin@example.com',
            password='Admin@123',
            first_name='Default',
            last_name='Admin',
        )

    if not User.objects.filter(username=demo_username).exists():
        User.objects.create_user(
            username=demo_username,
            email='user@example.com',
            password='User@123',
            first_name='Demo',
            last_name='User',
            approval_status='approved',
            role='stationery',
        )


def delete_default_users(apps, schema_editor):
    User = apps.get_model('core', 'User')
    User.objects.filter(username__in=['admin', 'user']).delete()


class Migration(migrations.Migration):
    dependencies = [
        ('core', '0022_delete_emailotp'),
    ]

    operations = [
        migrations.RunPython(create_default_users, delete_default_users),
    ]
